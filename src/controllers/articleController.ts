// server/src/controllers/articleController.ts
import { Request, Response } from 'express';
import slugify from 'slugify';
import Article from '../models/Article';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function formatDate(isoStr: string): string {
  const d = new Date(isoStr);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ── GET /api/articles ────────────────────────────────────────────
export async function getArticles(req: Request, res: Response): Promise<void> {
  try {
    const {
      category,
      search,
      featured,
      published = 'true',
      limit = 20,
      page = 1,
    } = req.query;

    const filter: Record<string, unknown> = {};
    if (published !== 'all')               filter.published   = published === 'true';
    if (category && category !== 'all')    filter.categoryKey = category;
    if (featured)                          filter.featured    = featured === 'true';
    if (search) {
      const q = new RegExp(search as string, 'i');
      filter.$or = [{ title: q }, { excerpt: q }, { tags: q }, { author: q }];
    }

    const skip     = (Number(page) - 1) * Number(limit);
    const total    = await Article.countDocuments(filter);
    const articles = await Article.find(filter)
      .sort({ dateISO: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      articles,
      total,
      page:  Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── GET /api/articles/featured ───────────────────────────────────
export async function getFeaturedArticle(_req: Request, res: Response): Promise<void> {
  try {
    const article = await Article.findOne({ featured: true, published: true });
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── GET /api/articles/:id ────────────────────────────────────────
export async function getArticleById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const article = id.match(/^[0-9a-fA-F]{24}$/)
      ? await Article.findById(id)
      : await Article.findOne({ slug: id });

    if (!article) { res.status(404).json({ message: 'Article not found' }); return; }
    res.json(article);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── GET /api/articles/:id/related ────────────────────────────────
export async function getRelatedArticles(req: Request, res: Response): Promise<void> {
  try {
    const article = await Article.findById(req.params.id);
    if (!article) { res.status(404).json({ message: 'Article not found' }); return; }

    const related = await Article.find({
      _id:         { $ne: article._id },
      published:   true,
      categoryKey: article.categoryKey,
    })
      .sort({ dateISO: -1 })
      .limit(3);

    // Pad with other published articles if not enough in same category
    if (related.length < 3) {
      const more = await Article.find({
        _id:       { $nin: [article._id, ...related.map(r => r._id)] },
        published: true,
      })
        .sort({ dateISO: -1 })
        .limit(3 - related.length);
      related.push(...more);
    }

    res.json(related);
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}

// ── POST /api/articles ───────────────────────────────────────────
export async function createArticle(req: Request, res: Response): Promise<void> {
  try {
    const body = { ...req.body };
    body.slug  = slugify(body.title, { lower: true, strict: true });
    if (body.dateISO) body.date = formatDate(body.dateISO);

    const article = await Article.create(body);
    res.status(201).json(article);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
}

// ── PUT /api/articles/:id ────────────────────────────────────────
export async function updateArticle(req: Request, res: Response): Promise<void> {
  try {
    const body = { ...req.body };
    if (body.title)   body.slug = slugify(body.title, { lower: true, strict: true });
    if (body.dateISO) body.date = formatDate(body.dateISO);

    const article = await Article.findByIdAndUpdate(req.params.id, body, {
      new: true, runValidators: true,
    });
    if (!article) { res.status(404).json({ message: 'Article not found' }); return; }
    res.json(article);
  } catch (err) {
    res.status(400).json({ message: (err as Error).message });
  }
}

// ── DELETE /api/articles/:id ─────────────────────────────────────
export async function deleteArticle(req: Request, res: Response): Promise<void> {
  try {
    const article = await Article.findByIdAndDelete(req.params.id);
    if (!article) { res.status(404).json({ message: 'Article not found' }); return; }
    res.json({ message: 'Article deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: (err as Error).message });
  }
}