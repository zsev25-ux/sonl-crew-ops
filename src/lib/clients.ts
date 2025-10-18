import Papa from 'papaparse'

export type Client = {
  name: string
  address: string
  neighborhood: string
  zip: string
  rehangPrice: number
  houseTier: number
  lifetimeSpend: number
  referral?: string
  notes?: string
  vip: boolean
}

export const cleanStr = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).replace(/\s+/g, ' ').trim()
}

export const num = (value: unknown): number => {
  const sanitized = cleanStr(value).replace(/[$,]/g, '')
  if (!sanitized) {
    return 0
  }

  const parsed = Number(sanitized)
  return Number.isFinite(parsed) ? parsed : 0
}

type CsvRow = {
  'Client Name'?: string
  Address?: string
  Neighborhood?: string
  Zip?: string
  'Rehang Price'?: string
  'House Tier'?: string
  'Lifetime Spend'?: string
  Referral?: string
  Notes?: string
}

const VIP_NEIGHBORHOODS = new Set(
  ['Country Ridge', 'Cherry Hills', 'Patriot Sub'].map((name) =>
    name.toLowerCase(),
  ),
)

const parseConfig = {
  header: true,
  skipEmptyLines: true,
  transformHeader(header: string): string {
    return header.replace(/\s+/g, ' ').trim()
  },
} satisfies Papa.ParseConfig<CsvRow>

const toClient = (row: CsvRow | null | undefined): Client | null => {
  if (!row) {
    return null
  }

  const name = cleanStr(row['Client Name'])
  if (!name) {
    return null
  }

  const address = cleanStr(row.Address)
  const neighborhood = cleanStr(row.Neighborhood)
  const zip = cleanStr(row.Zip)
  const rehangPrice = num(row['Rehang Price'])
  const houseTier = num(row['House Tier'])
  const lifetimeSpend = num(row['Lifetime Spend'])
  const referral = cleanStr(row.Referral)
  const notes = cleanStr(row.Notes)

  const vip =
    VIP_NEIGHBORHOODS.has(neighborhood.toLowerCase()) || lifetimeSpend >= 2000

  return {
    name,
    address,
    neighborhood,
    zip,
    rehangPrice,
    houseTier,
    lifetimeSpend,
    referral: referral ? referral : undefined,
    notes: notes ? notes : undefined,
    vip,
  }
}

const parseCsv = (source: string | File): Promise<CsvRow[]> =>
  new Promise((resolve, reject) => {
    Papa.parse<CsvRow>(source, {
      ...parseConfig,
      complete(results) {
        if (results.errors.length > 0) {
          reject(
            new Error(
              results.errors.map((error) => error.message).join('; '),
            ),
          )
          return
        }

        resolve(results.data)
      },
      error(error) {
        reject(error)
      },
    })
  })

const buildClients = (rows: CsvRow[]): Client[] =>
  rows
    .map((row) => toClient(row))
    .filter((client): client is Client => client !== null)

export async function loadClientsFromPublic(): Promise<Client[]> {
  const response = await fetch('/clients.csv', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(
      `Unable to load clients.csv (${response.status} ${response.statusText})`,
    )
  }

  const text = await response.text()
  const rows = await parseCsv(text)
  return buildClients(rows)
}

export async function loadClientsFromFile(file: File): Promise<Client[]> {
  const rows = await parseCsv(file)
  return buildClients(rows)
}

async function runDevSelfTest(): Promise<void> {
  const sample = `Client Name,Address,Neighborhood,Zip,Rehang Price,House Tier,Lifetime Spend,Referral,Notes
Jane Doe,42 Country Ln,Country Ridge,48197,175,3,1500,,Annual maintenance
Max Power,17 Highview Ct,East Side,48104,$250.00,2,2500,Radio Ad,VIP by spend`

  const clients = await parseCsv(sample).then((rows) => buildClients(rows))

  const neighborhoodVip = clients.find((client) => client.name === 'Jane Doe')
  const spendVip = clients.find((client) => client.name === 'Max Power')

  console.assert(
    neighborhoodVip?.vip === true,
    'Client loader: neighborhood VIP rule failed',
  )
  console.assert(
    spendVip?.vip === true &&
      spendVip.lifetimeSpend === 2500 &&
      spendVip.rehangPrice === 250,
    'Client loader: numeric coercion or VIP by spend failed',
  )
}

if (import.meta.env?.DEV) {
  runDevSelfTest().catch((error) => {
    console.error('Client loader self-test failed', error)
  })
}
