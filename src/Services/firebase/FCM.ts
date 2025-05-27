import { DataMessagePayload, MessagingPayload } from "firebase-admin/messaging";
import { FCMNotification } from "../../Types/FCMNotifications";
import Admin from "./Admin"

class FCM {
  public sendNotificationTo(token: string, payload: FCMNotification) {
    return Admin.getInstance().fcm.send({
      token: token,
      notification: {
        title: payload.title || 'New Message',
        body: payload.body || 'You have a new message',
      },
      data: payload.data || {},
    })
  }

  public sendDifusionNotification(topic: string, payload: FCMNotification) {
    return Admin.getInstance().fcm.send({
      topic: topic,
      notification: {
        title: payload.title || 'New Message',
        body: payload.body || 'You have a new message',
      },
      data: payload.data || {},
    })
  }
}

export default new FCM();