import { PushNotifications } from '@capacitor/push-notifications';
import { Capacitor } from '@capacitor/core';
import { supabase } from '../../lib/supabase';

export const pushNotificationService = {
  async initPushNotifications(employeeId: string) {
    if (!Capacitor.isNativePlatform()) {
      console.log('Push notifications are only supported on native mobile platforms (Android/iOS).');
      return;
    }

    try {
      // 1. Check permissions
      let permStatus = await PushNotifications.checkPermissions();

      // 2. Request permissions if not granted
      if (permStatus.receive === 'prompt') {
        permStatus = await PushNotifications.requestPermissions();
      }

      if (permStatus.receive !== 'granted') {
        console.warn('User denied push notification permissions.');
        return; // App continues working fine without push
      }

      // 3. Register for push notifications
      await PushNotifications.register();

      // 4. Add listeners for registration success/failure
      PushNotifications.addListener('registration', async (token) => {
        console.log('Push registration success, token:', token.value);
        await this.saveDeviceToken(employeeId, token.value);
      });

      PushNotifications.addListener('registrationError', (error: any) => {
        console.error('Error on push registration: ', error);
      });

      // 5. Add listener for push notifications received in foreground
      PushNotifications.addListener('pushNotificationReceived', (notification) => {
        console.log('Push received in foreground:', notification);
        // The in-app notification system handles foreground UI updates,
        // so we don't necessarily need to trigger an alert here unless desired.
      });

      // 6. Add listener for push notification taps
      PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
        console.log('Push action performed:', notification);
        const data = notification.notification.data;
        // Handle navigation based on payload metadata (Phase 12)
        this.handleNotificationTapNavigation(data);
      });

    } catch (error) {
      console.error('Failed to initialize push notifications:', error);
    }
  },

  async saveDeviceToken(employeeId: string, token: string) {
    try {
      const { error } = await (supabase.from('notification_devices') as any).upsert({
        employee_id: employeeId,
        token: token,
        platform: Capacitor.getPlatform(),
        is_active: true,
        last_seen_at: new Date().toISOString()
      }, { onConflict: 'token' });

      if (error) {
        console.error('Failed to save device token to Supabase:', error);
      }
    } catch (e) {
      console.error('Error saving device token:', e);
    }
  },

  async unregisterDeviceToken() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      // Note: We don't have the token readily available here unless we stored it locally.
      // But we can deactivate all tokens for the current user safely on logout via Supabase RPC or just let it expire.
      // A safe way is to delete/deactivate where employee_id = current user.
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await (supabase.from('notification_devices') as any)
          .update({ is_active: false })
          .eq('employee_id', user.id)
          .eq('platform', Capacitor.getPlatform());
      }
    } catch (error) {
      console.error('Error deactivating device token:', error);
    }
  },

  handleNotificationTapNavigation(data: any) {
    if (!data) return;

    // Navigate based on notification metadata (Phase 12)
    const entityType = data.entity_type?.toUpperCase();
    
    // We can emit a custom event that the App.tsx or routing logic listens to,
    // or directly manipulate window.location if router is not accessible here.
    let targetPath = '';
    
    switch (entityType) {
      case 'WFH':
        targetPath = '/admin/wfh';
        break;
      case 'LEAVE':
        targetPath = '/admin/leave';
        break;
      case 'PERMISSION':
        targetPath = '/admin/permission';
        break;
      case 'ATTENDANCE':
        targetPath = '/admin/attendance';
        break;
      case 'LOCATION':
      case 'GEOFENCE':
        targetPath = '/admin/live-tracking';
        break;
      case 'SECURITY':
      case 'FACE':
        targetPath = '/admin/face-registration';
        break;
      default:
        targetPath = '/admin/notifications';
    }

    if (targetPath) {
      // In a real app, you'd use a router reference or custom event. 
      // Using window.location for simplicity from outside React component context.
      window.location.href = targetPath;
    }
  }
};
