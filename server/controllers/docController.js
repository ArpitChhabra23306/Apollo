import { createRequire } from 'module';
import { Document, DocumentChunk } from '../models/Document.js';
import { chunkText, generateEmbeddings } from '../services/ragService.js';
import path from 'path';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

/**
 * POST /api/docs/upload
 * Accepts a multipart/form-data file, parses text, creates embeddings, and stores chunks.
 */
export async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { originalname, buffer, mimetype, size } = req.file;
    const ext = path.extname(originalname).toLowerCase().replace('.', '') || 'txt';

    let rawText = '';

    // 1. Extract text based on file format
    if (mimetype === 'application/pdf' || ext === 'pdf') {
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text || '';
    } else {
      // Text, Markdown, Source code, JSON
      rawText = buffer.toString('utf-8');
    }

    if (!rawText.trim()) {
      return res.status(400).json({ error: 'Could not extract text from uploaded file. File may be empty or unreadable.' });
    }

    // 2. Chunk text
    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      return res.status(400).json({ error: 'Document does not contain enough text to chunk.' });
    }

    // 3. Generate embeddings
    const embeddings = await generateEmbeddings(chunks);
    if (embeddings.length !== chunks.length) {
      return res.status(500).json({ error: 'Failed to generate vector embeddings for document.' });
    }

    // 4. Save Document metadata in MongoDB
    const doc = new Document({
      name: originalname,
      fileType: ext,
      fileSize: size,
      chunkCount: chunks.length,
      userId: req.body.userId || 'anonymous',
    });
    await doc.save();

    // 5. Bulk insert DocumentChunk records
    const chunkDocs = chunks.map((chunkStr, idx) => ({
      docId: doc._id,
      chunkIndex: idx,
      text: chunkStr,
      embedding: embeddings[idx],
    }));
    await DocumentChunk.insertMany(chunkDocs);

    res.status(201).json({
      success: true,
      message: `Document "${originalname}" uploaded and processed successfully (${chunks.length} chunks indexed).`,
      document: {
        id: doc._id,
        name: doc.name,
        fileType: doc.fileType,
        fileSize: doc.fileSize,
        chunkCount: doc.chunkCount,
        createdAt: doc.createdAt,
      }
    });
 } catch (error) {
 console.error('Error uploading document:', error);
 res.status(500).json({ error: 'Failed to process document', details: error.message });
 }
}

/**
 * GET /api/docs
 * Retrieves list of uploaded documents.
 */
export async function getUserDocuments(req, res) {
 try {
 const docs = await Document.find().sort({ createdAt: -1 }).lean();
 const formatted = docs.map(d => ({
 id: d._id,
 name: d.name,
 fileType: d.fileType,
 fileSize: d.fileSize,
 chunkCount: d.chunkCount,
 createdAt: d.createdAt,
 }));
 res.json({ documents: formatted });
 } catch (error) {
 console.error('Error fetching documents:', error);
 res.status(500).json({ error: 'Failed to fetch documents', details: error.message });
 }
}

/**
 * DELETE /api/docs/:id
 * Removes a document and all of its chunks.
 */
export async function deleteDocument(req, res) {
 const { id } = req.params;
 try {
 await DocumentChunk.deleteMany({ docId: id });
 await Document.findByIdAndDelete(id);
 res.json({ success: true, message: 'Document and vector embeddings deleted successfully.' });
 } catch (error) {
 console.error('Error deleting document:', error);
 res.status(500).json({ error: 'Failed to delete document', details: error.message });
 }
}
