import UserRecord from '../Models/UserRecord'
import { UserInterface } from '../Interfaces/UserInterface'

class UserRecordRepository {
  async index(): Promise<UserInterface[]> {
    const users = await UserRecord.findAll({
      order: [['created_at', 'DESC']],
    })

    return users.map((user) => this.mapUser(user))
  }

  async findById(id: string): Promise<UserInterface | null> {
    const user = await UserRecord.findByPk(id)
    return user ? this.mapUser(user) : null
  }

  async store(payload: UserInterface): Promise<UserInterface> {
    const [user] = await UserRecord.upsert(
      {
        ...payload,
        photoUrl: payload.photoUrl ?? null,
        password: payload.password ?? null,
        roles: payload.roles ?? {
          operator: false,
          admin: false,
        },
      },
      { returning: true }
    )

    return this.mapUser(user)
  }

  async setEnabled(id: string, enabledAt: number): Promise<UserInterface | null> {
    const user = await UserRecord.findByPk(id)
    if (!user) return null

    user.enabled_at = enabledAt
    await user.save()
    return this.mapUser(user)
  }

  async updatePassword(id: string, password: string): Promise<UserInterface | null> {
    const user = await UserRecord.findByPk(id)
    if (!user) return null

    user.password = password
    await user.save()
    return this.mapUser(user)
  }

  private mapUser(user: UserRecord): UserInterface {
    const plain = user.get({ plain: true }) as any
    return {
      id: plain.id,
      name: plain.name,
      email: plain.email,
      password: plain.password ?? null,
      phone: plain.phone,
      photoUrl: plain.photoUrl ?? null,
      enabled_at: Number(plain.enabled_at ?? 0),
      created_at: Number(plain.created_at ?? 0),
      roles: plain.roles ?? {
        operator: false,
        admin: false,
      },
    }
  }
}

export default UserRecordRepository
