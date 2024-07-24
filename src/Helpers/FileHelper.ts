import fs from 'fs'

export class FileHelper {
  static removeFolder(path: string): void {
    if (fs.existsSync(path)) {
      fs.readdirSync(path).forEach((file) => {
        const curPath = path + '/' + file
        if (fs.lstatSync(curPath).isDirectory()) {
          FileHelper.removeFolder(curPath)
        } else {
          fs.unlinkSync(curPath)
        }
      })
      fs.rmdirSync(path)
    }
  }
}
