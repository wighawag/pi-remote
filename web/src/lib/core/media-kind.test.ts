import {describe, it, expect} from 'vitest';
import {mediaKind, extractDownloadablePath} from './media-kind.js';

// The inline-media feature keys every preview off a file EXTENSION (the path is
// already server-validated, so no client MIME sniffing) and off a NARROWED set
// of tools: only `read` + `attach_file` get a download/preview affordance. These
// unit tests pin both halves of that decision.

describe('mediaKind', () => {
	it('classifies image extensions', () => {
		for (const ext of [
			'png',
			'jpg',
			'jpeg',
			'gif',
			'webp',
			'bmp',
			'svg',
			'avif',
		]) {
			expect(mediaKind(`/a/b/pic.${ext}`)).toBe('image');
		}
	});

	it('classifies audio extensions', () => {
		for (const ext of [
			'mp3',
			'wav',
			'oga',
			'ogg',
			'm4a',
			'aac',
			'flac',
			'opus',
		]) {
			expect(mediaKind(`/a/b/sound.${ext}`)).toBe('audio');
		}
	});

	it('classifies video extensions', () => {
		for (const ext of ['mp4', 'webm', 'mov', 'm4v', 'ogv']) {
			expect(mediaKind(`/a/b/clip.${ext}`)).toBe('video');
		}
	});

	it('is case-insensitive', () => {
		expect(mediaKind('/x/PHOTO.PNG')).toBe('image');
		expect(mediaKind('/x/Song.Mp3')).toBe('audio');
		expect(mediaKind('/x/Movie.MP4')).toBe('video');
	});

	it('returns null for non-media, directory, and search paths', () => {
		expect(mediaKind('/a/b/notes.txt')).toBeNull();
		expect(mediaKind('/a/b/archive.zip')).toBeNull();
		expect(mediaKind('/a/b/src')).toBeNull(); // directory, no extension
		expect(mediaKind('/a/b/')).toBeNull();
		expect(mediaKind('*.ts')).toBeNull(); // glob / search scope
		expect(mediaKind('')).toBeNull();
		// A dot in a directory name must not be mistaken for an extension.
		expect(mediaKind('/a/my.dir/file')).toBeNull();
	});
});

describe('extractDownloadablePath', () => {
	it('returns the path for read and attach_file', () => {
		expect(extractDownloadablePath('read', {path: '/a/b.png'}, false)).toBe(
			'/a/b.png',
		);
		expect(
			extractDownloadablePath('attach_file', {path: '/a/b.pdf'}, false),
		).toBe('/a/b.pdf');
	});

	it('is null for write and edit (a download of a just-written file is noise)', () => {
		expect(
			extractDownloadablePath('write', {path: '/a/b.txt'}, false),
		).toBeNull();
		expect(
			extractDownloadablePath('edit', {path: '/a/b.txt'}, false),
		).toBeNull();
	});

	it('is null for directory/search tools (ls/grep/find)', () => {
		expect(extractDownloadablePath('ls', {path: '/a'}, false)).toBeNull();
		expect(extractDownloadablePath('grep', {path: '/a'}, false)).toBeNull();
		expect(extractDownloadablePath('find', {path: '/a'}, false)).toBeNull();
	});

	it('is case-insensitive on the tool name', () => {
		expect(extractDownloadablePath('READ', {path: '/a/b.png'}, false)).toBe(
			'/a/b.png',
		);
		expect(
			extractDownloadablePath('Attach_File', {path: '/a/b.png'}, false),
		).toBe('/a/b.png');
	});

	it('accepts filepath/file arg aliases and trims whitespace', () => {
		expect(extractDownloadablePath('read', {filepath: '/a/b.png'}, false)).toBe(
			'/a/b.png',
		);
		expect(extractDownloadablePath('read', {file: '/a/b.png'}, false)).toBe(
			'/a/b.png',
		);
		expect(extractDownloadablePath('read', {path: '  /a/b.png  '}, false)).toBe(
			'/a/b.png',
		);
	});

	it('is null on error, missing args, or empty/blank path', () => {
		expect(
			extractDownloadablePath('read', {path: '/a/b.png'}, true),
		).toBeNull();
		expect(extractDownloadablePath('read', null, false)).toBeNull();
		expect(extractDownloadablePath('read', {}, false)).toBeNull();
		expect(extractDownloadablePath('read', {path: '   '}, false)).toBeNull();
	});
});
