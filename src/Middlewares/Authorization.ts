import { Request, Response, NextFunction } from 'express'
import config from '../../config'
import Admin from '../Services/firebase/Admin'
import {
  getAdminVersionPolicy,
  isAdminVersionSupported,
  VERSION_UNSUPPORTED_CODE,
} from '../Helpers/VersionPolicy'

interface AuthenticatedRequest extends Request {
  isAuthenticated?: boolean
}

export interface DriverAuthenticatedRequest extends Request {
  driverUid?: string
}

function respondUnauthorized(res: Response, message: string) {
  return res.status(401).json({
    success: false,
    message,
    data: {},
  })
}

function respondServerConfigurationError(res: Response) {
  return res.status(500).json({
    success: false,
    message: 'Server configuration error',
    data: {},
  })
}

function respondVersionUnsupported(res: Response) {
  return res.status(426).json({
    success: false,
    message: 'Client version is no longer supported',
    data: {
      code: VERSION_UNSUPPORTED_CODE,
      admin: getAdminVersionPolicy(),
    },
  })
}

function validateServerApiKey(req: Request, res: Response): boolean {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    respondUnauthorized(res, 'Authorization header missing or invalid format')
    return false
  }

  const token = authHeader.substring(7)
  const validApiKey = config.SERVER_API_KEY

  if (!validApiKey) {
    console.error('SERVER_API_KEY environment variable not set')
    respondServerConfigurationError(res)
    return false
  }

  if (token !== validApiKey) {
    respondUnauthorized(res, 'Invalid API key')
    return false
  }

  return true
}

export const requireAuth = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (!validateServerApiKey(req, res)) {
      return
    }

    const clientPlatform = String(req.headers['x-client-platform'] ?? '').trim()
    const clientVersion = String(req.headers['x-client-version'] ?? '').trim()
    if (clientPlatform !== 'admin' || !isAdminVersionSupported(clientVersion)) {
      return respondVersionUnsupported(res)
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

export const requireInternalAuth = (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    if (!validateServerApiKey(req, res)) {
      return
    }

    req.isAuthenticated = true
    next()
  } catch (error) {
    console.error('Internal authorization error:', error)
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      data: {},
    })
  }
}

export const requireDriverAuth = async (
  req: DriverAuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.warn(
        `Driver authorization rejected path=${req.method} ${req.originalUrl} reason=missing_or_invalid_authorization_header`
      )
      return res.status(401).json({
        success: false,
        message: 'Authorization header missing or invalid format',
        data: {},
      })
    }

    const token = authHeader.substring(7)
    const decodedToken = await Admin.getInstance().auth.verifyIdToken(token)
    req.driverUid = decodedToken.uid
    next()
  } catch (error) {
    const failureReason =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error(
      `Driver authorization error path=${req.method} ${req.originalUrl} reason=${failureReason}`,
      error
    )
    return res.status(401).json({
      success: false,
      message: 'Invalid driver token',
      data: {},
    })
  }
}
