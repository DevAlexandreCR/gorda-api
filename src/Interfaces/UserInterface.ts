export interface UserRoles {
  operator: boolean
  admin: boolean
  superadmin?: boolean
}

export interface UserInterface {
  id: string
  name: string
  email: string
  password?: string | null
  phone: string
  photoUrl?: string | null
  enabled_at: number
  created_at: number
  roles: UserRoles
}
