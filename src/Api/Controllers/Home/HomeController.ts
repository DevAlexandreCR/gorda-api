import { Request, Response, Router } from 'express'
import path from 'path'

const controller = Router()

controller.get('/', async (req: Request, res: Response) => {
  try {
    const htmlPath = path.join(__dirname, '../../../views/index.html')
    return res.sendFile(htmlPath)
  } catch (error) {
    console.error('Error serving HTML file:', error)
    return res.status(500).json({
      success: false,
      message: 'Error serving HTML file',
    })
  }
})

export default controller