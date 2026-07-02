import { LocalNotifications } from '@capacitor/local-notifications';

const REVIEW_REMINDER_ID = 1;

function isNative(): boolean {
  return typeof (window as any).Capacitor !== 'undefined' && (window as any).Capacitor.isNativePlatform();
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative()) return false;
  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display === 'granted') return true;
    const result = await LocalNotifications.requestPermissions();
    return result.display === 'granted';
  } catch {
    return false;
  }
}

export async function scheduleReviewReminder(hour: number = 9, minute: number = 0): Promise<void> {
  if (!isNative()) return;
  try {
    const granted = await requestNotificationPermission();
    if (!granted) return;

    // Cancel existing reminder
    await LocalNotifications.cancel({ notifications: [{ id: REVIEW_REMINDER_ID }] });

    // Schedule daily reminder
    await LocalNotifications.schedule({
      notifications: [{
        id: REVIEW_REMINDER_ID,
        title: '该复习单词了！',
        body: '打开论文阅读器，完成今日的生词复习吧',
        schedule: {
          on: {
            hour,
            minute,
          },
          allowWhileIdle: true,
        },
        sound: 'default',
        actionTypeId: 'review',
      }],
    });
  } catch {
    // Silently fail on web or unsupported platforms
  }
}

export async function cancelReviewReminder(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REVIEW_REMINDER_ID }] });
  } catch {
    // Silently fail on web or unsupported platforms
  }
}

export async function getReminderStatus(): Promise<{ scheduled: boolean; hour?: number; minute?: number }> {
  if (!isNative()) return { scheduled: false };
  try {
    const pending = await LocalNotifications.getPending();
    const reminder = pending.notifications.find(n => n.id === REVIEW_REMINDER_ID);
    if (!reminder) return { scheduled: false };
    const schedule = reminder.schedule as any;
    return {
      scheduled: true,
      hour: schedule?.on?.hour,
      minute: schedule?.on?.minute,
    };
  } catch {
    return { scheduled: false };
  }
}
