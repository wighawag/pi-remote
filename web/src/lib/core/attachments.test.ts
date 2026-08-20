import {describe, it, expect} from 'vitest';
import {buildAttachmentMessage} from './attachments.js';

describe('buildAttachmentMessage', () => {
	it('returns the trimmed text when there are no attachments', () => {
		expect(buildAttachmentMessage('  hello  ', [])).toBe('hello');
	});

	it('appends file lines after the prose, separated by a blank line', () => {
		expect(buildAttachmentMessage('look at this', ['/tmp/1_a.png'])).toBe(
			'look at this\n\n[Uploaded file: /tmp/1_a.png]',
		);
	});

	it('lists every path on its own line', () => {
		expect(buildAttachmentMessage('two', ['/tmp/a', '/tmp/b'])).toBe(
			'two\n\n[Uploaded file: /tmp/a]\n[Uploaded file: /tmp/b]',
		);
	});

	it('states the intent when the files are the whole message', () => {
		expect(buildAttachmentMessage('   ', ['/tmp/a'])).toBe(
			'I have uploaded the following file(s) for you:\n[Uploaded file: /tmp/a]',
		);
	});
});
