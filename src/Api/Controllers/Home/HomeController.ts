import { Request, Response, Router } from 'express'
import path from 'path'

const controller = Router()

controller.get('/', async (req: Request, res: Response) => {
  const htmlPath = path.join(__dirname, '../../../views/index.html')
  return res.sendFile(htmlPath)
})

export default controller