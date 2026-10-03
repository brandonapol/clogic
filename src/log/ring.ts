export type Ring<T> = {
  readonly capacity: number
  readonly items: readonly T[]
}

export const createRing = <T>(capacity: number): Ring<T> => ({
  capacity: Math.max(0, Math.floor(capacity)),
  items: [],
})

export const pushRing = <T>(ring: Ring<T>, item: T): Ring<T> => ({
  capacity: ring.capacity,
  items: ring.capacity === 0 ? [] : [...ring.items, item].slice(-ring.capacity),
})
