class DateHelper {
	
	dateString(): string {
		return new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" });
	}
}

export default new DateHelper()