import { fireEvent, render, screen } from '@testing-library/svelte'
import { describe, expect, it } from 'vitest'
import Counter from './fixtures/Counter.svelte'

describe('Counter', () => {
	it('increments on click', async () => {
		render(Counter)
		const button = screen.getByRole('button')
		expect(button).toHaveTextContent('count is 0')
		await fireEvent.click(button)
		expect(button).toHaveTextContent('count is 1')
	})
})
