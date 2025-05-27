import { DataMessagePayload, MessagingPayload } from "firebase-admin/messaging";
import { FCMNotification } from "../../Types/FCMNotifications";
import Admin from "./Admin"

class FCM {
  public sendNotificationTo(token: string, payload: FCMNotification) {
    return Admin.getInstance().fcm.send({
      token: token,
      data: payload.data || {},
    })
  }

  public sendDifusionNotification(topic: string, payload: FCMNotification) {
    return Admin.getInstance().fcm.send({
      topic: topic,
      data: payload.data || {},
    })
  }
}

export default new FCM();