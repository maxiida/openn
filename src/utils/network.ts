import isURL from 'validator/es/lib/isURL'

export const isValidUrl = (value: string) =>
  isURL(value.trim(), {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true,
    require_host: true,
    require_tld: false,
  })
