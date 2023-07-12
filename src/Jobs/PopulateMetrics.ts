import axios from 'axios'
import config from '../../config'
import dayjs from 'dayjs'

const POPULATE_PATH = '/metrics/populate'
export async function populateMetrics(): Promise<void> {
	const startDate = dayjs().tz('America/Bogota').subtract(1, 'day').format('YYYY-MM-DD').toString()
	const endDate = dayjs().tz('America/Bogota').subtract(1, 'day').format('YYYY-MM-DD').toString()
	axios.post(config.GORDA_API_FUNCTIONS + POPULATE_PATH, {
		startDate: startDate,
		endDate: endDate
	}).then((res) => {
		console.log(res.data)
	}).catch((e) => {
		console.log(e.message)
	})
}