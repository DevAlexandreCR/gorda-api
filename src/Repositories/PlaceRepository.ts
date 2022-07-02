import DBService from '../Services/firebase/Database'
import {PlaceInterface} from '../Interfaces/PlaceInterface'
import Place from '../Models/Place'

class PlaceRepository {

/* istanbul ignore next */
  getAll(listener: (place: Place)=> void): void {
    DBService.dbPlaces().on('child_added', (snapshot) => {
      const place = snapshot.val() as PlaceInterface
      const placeTmp = new Place
      Object.assign(placeTmp, place)
      listener(placeTmp)
    })
  }
}

export default new PlaceRepository()