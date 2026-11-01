import { describe, expect, it } from 'vitest';

describe('backend test setup', () => {
    it('runs TypeScript ES module tests', () => {
        expect(import.meta.url).toMatch(/setup\.spec\.ts$/);
    });
});
