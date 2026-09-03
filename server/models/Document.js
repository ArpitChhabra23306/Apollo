import mongoose from 'mongoose';

const documentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  fileType: { type: String, default: 'txt' },
  fileSize: { type: Number, default: 0 },
  chunkCount: { type: Number, default: 0 },
  userId: { type: String, default: 'anonymous' },
}, {
  timestamps: true
});

const documentChunkSchema = new mongoose.Schema({
  docId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, index: true },
  chunkIndex: { type: Number, required: true },
  text: { type: String, required: true },
  embedding: { type: [Number], required: true },
}, {
  timestamps: true
});

export const Document = mongoose.model('Document', documentSchema);
export const DocumentChunk = mongoose.model('DocumentChunk', documentChunkSchema);

export default Document;
