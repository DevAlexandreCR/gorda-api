import { Interactive } from "./Interactive"

export type ApiMessage = {
    messaging_product: string,
    to: string,
    type: 'INTERACTIVE' | 'LOCATION' | 'TEXT' | 'LINK_PREVIEW',
    text: {
        body: string
    },
    interactive?: Interactive
}