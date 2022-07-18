import users from './users'
import common from './common'
import validations from './validations'
import services from './services'
import drivers from "./drivers";

export default {
  routes: {
    dashboard: 'Dashboard',
    users: 'Users',
    drivers: 'Drivers',
    places: 'Places'
  },
  users: users,
  common: common,
  validations: validations,
  services: services,
  drivers: drivers
}