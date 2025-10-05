import { Request, Response, NextFunction } from 'express'
import config from '../../config'

interface AuthenticatedRequest extends Request {
  isAuthenticated?: boolean
}

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authorization header missing or invalid format',
        data: {},
      })
    }

    const token = authHeader.substring(7) // Remove 'Bearer ' prefix
    const validApiKey = config.SERVER_API_KEY

    if (!validApiKey) {
      console.error('SERVER_API_KEY environment variable not set')
      return res.status(500).json({
        success: false,
        message: 'Server configuration error',
        data: {},
      })
    }

    if (token !== validApiKey) {
      return res.status(401).json({
        success: false,
        message: 'Invalid API key',
        data: {},
      })
    }

    req.isAuthenticated = true
    next()
  } catch (error) {
    console.error('Authorization error:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
}
