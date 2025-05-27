import { FCMNotification } from "../../Types/FCMNotifications";
import Admin from "./Admin"

class FCM {
  public sendNotificationTo(token: string, payload: FCMNotification) {
    return Admin.getInstance().fcm.send({
      token,
      ...payload
    })
  }

  public sendDifusionNotification(topic: string, payload: FCMNotification) {
    return Admin.getInstance().fcm.sendToTopic(topic, {
      ...payload
    })
  }
}

export default new FCM();