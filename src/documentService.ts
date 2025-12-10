import * as path from 'path';

export interface ParsedDocument {
    text: string;
    title?: string;
    pageCount?: number;
}

export type SupportedFormat = 'pdf' | 'docx' | 'txt' | 'md';

export class DocumentService {
    private pdfParse: typeof import('pdf-parse') | null = null;
    private mammoth: typeof import('mammoth') | null = null;

    // Lazy load pdf-parse
    private async getPdfParse() {
        if (!this.pdfParse) {
            this.pdfParse = (await import('pdf-parse')).default;
        }
        return this.pdfParse;
    }

    // Lazy load mammoth
    private async getMammoth() {
        if (!this.mammoth) {
            this.mammoth = await import('mammoth');
        }
        return this.mammoth;
    }

    getSupportedFormats(): string[] {
        return ['pdf', 'docx', 'txt', 'md'];
    }

    detectFormat(filename: string, mimeType?: string): SupportedFormat | null {
        const ext = path.extname(filename).toLowerCase().slice(1);

        // Check extension first
        if (['pdf', 'docx', 'txt', 'md'].includes(ext)) {
            return ext as SupportedFormat;
        }

        // Fallback to MIME type
        if (mimeType) {
            if (mimeType === 'application/pdf') return 'pdf';
            if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
            if (mimeType === 'text/plain') return 'txt';
            if (mimeType === 'text/markdown') return 'md';
        }

        return null;
    }

    async parseBuffer(buffer: Buffer, format: SupportedFormat, filename?: string): Promise<ParsedDocument> {
        switch (format) {
            case 'pdf':
                return this.parsePdfBuffer(buffer);
            case 'docx':
                return this.parseDocxBuffer(buffer);
            case 'txt':
            case 'md':
                return { text: buffer.toString('utf-8'), title: filename };
            default:
                throw new Error(`Unsupported format: ${format}`);
        }
    }

    private async parsePdfBuffer(buffer: Buffer): Promise<ParsedDocument> {
        const pdfParse = await this.getPdfParse();
        // pdf-parse exports default as the function
        const parse = typeof pdfParse === 'function' ? pdfParse : (pdfParse as any).default;
        const data = await parse(buffer);

        return {
            text: this.cleanText(data.text),
            pageCount: data.numpages,
            title: data.info?.Title,
        };
    }

    private async parseDocxBuffer(buffer: Buffer): Promise<ParsedDocument> {
        const mammoth = await this.getMammoth();
        const result = await mammoth.extractRawText({ buffer });

        return {
            text: this.cleanText(result.value),
        };
    }

    private cleanText(text: string): string {
        return text
            // Normalize line endings
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            // Remove excessive whitespace
            .replace(/[ \t]+/g, ' ')
            // Remove excessive newlines (more than 2)
            .replace(/\n{3,}/g, '\n\n')
            // Trim
            .trim();
    }
}
