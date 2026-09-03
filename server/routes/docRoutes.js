import { Router } from 'express';
import multer from 'multer';
import { uploadDocument, getUserDocuments, deleteDocument } from '../controllers/docController.js';

const router = Router();

// Configure Multer for in-memory uploads up to 10MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.post('/upload', upload.single('file'), uploadDocument);
router.get('/', getUserDocuments);
router.delete('/:id', deleteDocument);

export default router;
