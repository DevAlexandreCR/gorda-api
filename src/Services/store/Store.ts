import Driver from '../../Models/Driver'
import Place from '../../Models/Place'
import PlaceRepository from '../../Repositories/PlaceRepository'
import DriverRepository from '../../Repositories/DriverRepository'

export class Store {
  
  static instance: Store;
  drivers: Set<Driver> = new Set<Driver>()
  places: Set<Place> = new Set<Place>()
  
  private constructor() {
    this.setDrivers()
    this.setPlaces()
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
  
  private setDrivers() {
    DriverRepository.getAll((driver) => {
      this.drivers.add(driver)
    })
  }
}