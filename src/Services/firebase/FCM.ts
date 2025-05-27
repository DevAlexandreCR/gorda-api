import { DataMessagePayload, MessagingPayload } from "firebase-admin/messaging";
import { FCMNotification } from "../../Types/FCMNotifications";
import Admin from "./Admin"

class FCM {
  public sendNotificationTo(token: string, payload: FCMNotification) {
    return Admin.getInstance().fcm.send({
      token: "diH3B-rHTcCLQJNt4BVcE0:APA91bFETDikqUcsjcf3CYSyIrFXrNf-nONg3x9icxmUPLIWBDN8qtV0Uh4iEytkK_vjgNNW91aZP6t9ILpEBWziQGjExtIJSx6yXXUUQF4AtloNxmzlkJE",
      notification: {
        title: payload.title || 'New Message',
        body: payload.body || 'You have a new message',
      },
      data: payload.data || {},
    })
  }

  public sendDifusionNotification(topic: string, payload: FCMNotification) {
    return Admin.getInstance().fcm.sendToTopic(topic, {
      notification: {
        title: payload.title || 'New Message',
        body: payload.body || 'You have a new message',
      },
      data: payload.data || {},
    } as MessagingPayload)
  }
}

export default new FCM();