import Driver from '../../Models/Driver'
import Place from '../../Models/Place'
import PlaceRepository from '../../Repositories/PlaceRepository'
import DriverRepository from '../../Repositories/DriverRepository'
import ClientRepository from '../../Repositories/ClientRepository'
import Client from '../../Models/Client'
import MessageHelper from '../../Helpers/MessageHelper'

export class Store {
  
  static instance: Store;
  drivers: Set<Driver> = new Set<Driver>()
  places: Set<Place> = new Set<Place>()
  clients: Set<Client> = new Set<Client>()
  
  private constructor() {
    this.setDrivers()
    this.setPlaces()
    this.setClients()
  }
  
  public static getInstance(): Store {
    if (!Store.instance) {
      Store.instance = new Store();
    }
    return Store.instance;
  }
  
  private setPlaces() {
    PlaceRepository.getAll((place) => {
      this.places.add(place)
    })
  }
  
  private setClients() {
    ClientRepository.getAll((client) => {
      this.clients.add(client)
    })
  }
  
  private setDrivers() {
    DriverRepository.getAll((driver) => {
      this.drivers.add(driver)
    })
  }
  
  findDriverById(driverId: string): Driver {
    const driversArray = Array.from(this.drivers)
    return  driversArray.find(dri => dri.id === driverId) ?? new Driver()
  }
  
  findClientById(clientId: string): Client|undefined {
    const clientsArray = Array.from(this.clients)
    return  clientsArray.find(dri => dri.id === clientId)
  }
  
  findPlaceByName(placeName: string): Place|undefined {
    const placesArray = Array.from(this.places)
    return placesArray.find(pla => {
      return MessageHelper.normalice(pla.name) === MessageHelper.normalice(placeName)
    })
  }
}