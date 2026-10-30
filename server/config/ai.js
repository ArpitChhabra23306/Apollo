import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'path';

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const apiKey = process.env.OPENAI_API_KEY || process.env.OPENAI_ADMIN_KEY;
const openai = new OpenAI({ apiKey });

export default openai;
