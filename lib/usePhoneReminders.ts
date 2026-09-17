'use client';

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const VAPID_PUBLIC_KEY = 'BGjDgypG1k9SDmpeBIsZk7F21LsqH0FFxUMk5uHbkGBZyuUqLOpqkXdW8opSlwpW1Hdxdhl5vKvKkiF7xVQdNjc';

export type PhoneReminderStatus = 'checking' | 'ready' | 'enabled' | 'denied' | 'unsupported' | 'error';

function decodeVapidKey(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

function supportsPushNotifications() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function usePhoneReminders(userId: string, familyId: 'mom' | 'dad' | '') {
  const [status, setStatus] = useState<PhoneReminderStatus>('checking');
  const [message, setMessage] = useState('');

  const saveSubscription = useCallback(async (subscription: PushSubscription) => {
    if (!supabase || !userId || !familyId) throw new Error('Missing reminder account');
    const serialized = subscription.toJSON();
    if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys?.auth) {
      throw new Error('Incomplete push subscription');
    }
    const { error } = await supabase.from('push_subscriptions').upsert({
      endpoint: serialized.endpoint,
      user_id: userId,
      family_id: familyId,
      p256dh: serialized.keys.p256dh,
      auth: serialized.keys.auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' });
    if (error) throw error;
  }, [familyId, userId]);

  useEffect(() => {
    if (!userId || !familyId) return;
    let cancelled = false;
    void (async () => {
      if (!supportsPushNotifications()) {
        if (!cancelled) {
          setStatus('unsupported');
          setMessage('This phone does not support web reminders.');
        }
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register('/sw.js');
        if (cancelled) return;
        if (Notification.permission === 'denied') {
          setStatus('denied');
          setMessage('Reminders are blocked in this phone’s settings.');
          return;
        }
        const subscription = await registration.pushManager.getSubscription();
        if (subscription && Notification.permission === 'granted') {
          await saveSubscription(subscription);
          if (!cancelled) {
            setStatus('enabled');
            setMessage('This phone will receive reminders 30 minutes before your events.');
          }
        } else if (!cancelled) {
          setStatus('ready');
          setMessage('Enable reminders on this phone.');
        }
      } catch {
        if (!cancelled) {
          setStatus('error');
          setMessage('Reminders could not be prepared. Please try again.');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [familyId, saveSubscription, userId]);

  const enable = useCallback(async () => {
    if (!supportsPushNotifications()) {
      setStatus('unsupported');
      setMessage('This phone does not support web reminders.');
      return;
    }
    setStatus('checking');
    setMessage('Turning on reminders…');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus('denied');
        setMessage('Reminders were not allowed. You can change this in your phone’s settings.');
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing ?? await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeVapidKey(VAPID_PUBLIC_KEY),
      });
      await saveSubscription(subscription);
      setStatus('enabled');
      setMessage('This phone will receive reminders 30 minutes before your events.');
    } catch {
      setStatus('error');
      setMessage('Reminders could not be enabled. Please try again.');
    }
  }, [saveSubscription]);

  const disable = useCallback(async () => {
    setStatus('checking');
    setMessage('Turning off reminders…');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription && supabase) {
        await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
        await subscription.unsubscribe();
      }
      setStatus('ready');
      setMessage('Reminders are off on this phone.');
    } catch {
      setStatus('error');
      setMessage('Reminders could not be turned off. Please try again.');
    }
  }, []);

  const test = useCallback(async () => {
    setMessage('Sending a test notification…');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (Notification.permission !== 'granted' || !subscription) {
        setStatus('ready');
        setMessage('Enable reminders before sending a test notification.');
        return;
      }
      await saveSubscription(subscription);
      await registration.showNotification('Family Calendar', {
        body: 'Test successful — this phone can display calendar reminders.',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        tag: `family-calendar-test-${Date.now()}`,
        data: { url: '/' },
      });
      setMessage('Test sent. It should appear on this phone now.');
    } catch {
      setMessage('The test notification could not be displayed. Check this app in iPhone notification settings.');
    }
  }, [saveSubscription]);

  return {
    status,
    message,
    toggle: status === 'enabled' ? disable : enable,
    test,
  };
}
