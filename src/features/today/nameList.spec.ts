import { describe, expect, it } from 'vitest'
import { nameList } from './nameList'

describe('nameList', () => {
  it.each([
    ['en', 'Dentist and Gym'], ['es', 'Dentist y Gym'], ['fr', 'Dentist et Gym'], ['pt', 'Dentist e Gym'], ['de', 'Dentist und Gym'],
  ])('joins two names with the conjunction of %s', (locale, expected) => {
    expect(nameList(locale, ['Dentist', 'Gym'])).toBe(expected)
  })

  it('leaves one name alone and lists three with the last conjunction', () => {
    expect(nameList('en', ['Dentist'])).toBe('Dentist')
    expect(nameList('es', ['A', 'B', 'C'])).toBe('A, B y C')
  })
})
