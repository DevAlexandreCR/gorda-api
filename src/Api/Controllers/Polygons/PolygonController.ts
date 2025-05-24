import { Router } from "express"
import { Buffer } from 'buffer'
import { parseStringPromise } from 'xml2js'
import { LatLng } from "../../../Interfaces/LatLng"
import SettingsRepository from "../../../Repositories/SettingsRepository"

const controller = Router()

controller.post('/polygon', async (req, res) => {
    const { body } = req
    const { polygonKML } = body

    if (!polygonKML) {
        return res.status(422).send({ error: 'polygonKML is required' })
    }

    let decodedXML
    try {
        decodedXML = Buffer.from(polygonKML, 'base64').toString('utf-8')
    } catch (error) {
        return res.status(422).send({ error: 'Invalid base64 string' })
    }

    if (!decodedXML.trim().startsWith('<?xml') || !decodedXML.includes('<kml')) {
        return res.status(422).send({ error: 'Invalid KML file' })
    }

    let kmlData
    try {
        kmlData = await parseStringPromise(decodedXML)
    } catch (error) {
        return res.status(422).send({ error: 'Invalid KML format' })
    }

    const idParts = kmlData.kml.Document[0].Placemark[0].ExtendedData[0].Data[0].value[0]
    const branchId = idParts.split('.')[0]
    const cityId = idParts.split('.')[1]
    const polygon = kmlData.kml.Document[0].Placemark[0].Polygon[0].outerBoundaryIs[0].LinearRing[0].coordinates[0].split('\n')

    const coordinates = Array<LatLng>()

    polygon.forEach((point: string) => {
        point = point.trim()
        const [latitude, longitude] = point.split(',')
        if (!longitude || !latitude) {
            return
        }
        const location: LatLng = {
            lat: parseFloat(latitude),
            lng: parseFloat(longitude)
        }
        coordinates.push(location)
    })

    await SettingsRepository.setCoordinates(branchId, cityId, coordinates).catch((error) => {
        console.error('Error saving coordinates', error)
        return res.status(500).send({ error: 'Error saving coordinates' })
    })

    res.status(200).send({ message: 'Polygon imported' })
})

export default controller