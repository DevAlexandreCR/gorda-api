import { Request, Response, Router } from "express"
import { Store } from "../../../Services/store/Store"

const controller = Router()
const store = Store.getInstance()

controller.post('/messages/drivers', async (req: Request, res: Response) => {
    const { body } = req
    const to = body.to

    if (!to) {

    } else {

    }

    return res.sendStatus(200)
})