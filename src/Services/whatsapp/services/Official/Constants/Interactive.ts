export type Interactive = {
    type: 'list' | 'button' | 'product' | 'flow' | 'location_request_message',
    body?: {
        text: string
    },
    action: {
        name: string
    },
    footer?: {
        text: string
    }
}