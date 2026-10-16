// Ordenação por rua para o condomínio (ruas numeradas em sequência).
// Reconhece "Rua 3", "rua 03", "R. 3", "R3", "Rua três" não é tratado (apenas números).
const STREET_RE = /(?:^|[^\p{L}\d])(?:rua|r)\.?\s*(?:n[ºo°.]*\s*)?0*(\d{1,3})(?!\d)/iu;
const HOUSE_RE = /(?:casa|cs|c|lote|lt|n[ºo°]|n\.|número|numero|apto|ap|apartamento)\.?\s*[:\-]?\s*0*(\d{1,5})(?!\d)/iu;

export function parseStreetAddress(address) {
  const text = String(address || '').trim();
  const street = STREET_RE.exec(text);
  const streetNumber = street ? Number(street[1]) : null;
  let house = null;
  if (street) {
    const rest = text.slice(street.index + street[0].length);
    const labelled = HOUSE_RE.exec(rest);
    const loose = /(\d{1,5})/.exec(rest);
    house = labelled ? Number(labelled[1]) : loose ? Number(loose[1]) : null;
  }
  return { streetNumber, houseNumber: house };
}

// Endereços sem rua reconhecida vão para o fim, mantendo a ordem original entre si.
export function compareByStreet(a, b) {
  const first = parseStreetAddress(a?.address);
  const second = parseStreetAddress(b?.address);
  const left = first.streetNumber ?? Infinity;
  const right = second.streetNumber ?? Infinity;
  if (left !== right) return left < right ? -1 : 1;
  const houseLeft = first.houseNumber ?? Infinity;
  const houseRight = second.houseNumber ?? Infinity;
  if (houseLeft !== houseRight) return houseLeft < houseRight ? -1 : 1;
  return 0;
}

export const sortByStreet = orders => [...orders].sort(compareByStreet);
