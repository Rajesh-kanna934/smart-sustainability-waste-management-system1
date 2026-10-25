import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Initialize Gemini client lazily or safely
const apiKey = process.env.GEMINI_API_KEY;
let aiClient: GoogleGenAI | null = null;

if (apiKey && apiKey !== 'MY_GEMINI_API_KEY' && apiKey.trim().length > 0) {
  try {
    aiClient = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.error('Failed to initialize GoogleGenAI client:', err);
  }
}

// Fallback sustainability knowledge base helper
function generateFallbackResponse(userPrompt: string): string {
  const query = userPrompt.toLowerCase().trim();

  if (query.includes('plastic')) {
    return `### ♻️ Recycling Plastic Guidance
- **Check Resin Codes:** Look for recycling numbers #1 (PET) and #2 (HDPE), which are widely accepted in curbside recycling bins.
- **Rinse & Dry:** Always rinse food residue off bottles and containers to avoid contaminating the recycling stream.
- **Caps & Lids:** In most modern facilities, screw caps back on bottles before disposing.
- **Film & Bags:** Soft plastic bags and film (#4 LDPE) should not go into standard bins—take them to grocery store collection points.
- **Recommended 4R Action:** **Reduce** single-use plastics by carrying reusable bottles and bags!`;
  }

  if (query.includes('cloth') || query.includes('shirt') || query.includes('textile') || query.includes('wear')) {
    return `### 🔄 Reusing Old Clothes
- **Donate or Swap:** If still wearable, list them on this platform for others to reuse or donate to local shelters and thrift stores.
- **Upcycling Ideas:** Cut worn-out t-shirts into cleaning rags, produce bags, or craft quilts.
- **Mending:** Fix small tears or replace missing buttons before considering disposal.
- **Textile Recycling:** Clothes beyond repair can be delivered to designated textile recyclers for insulation or fiber reclamation.
- **Recommended 4R Action:** **Reuse** first, then recycle fibers!`;
  }

  if (query.includes('phone') || query.includes('laptop') || query.includes('electronics') || query.includes('battery') || query.includes('computer')) {
    return `### 📱 Electronics & E-Waste Guidance
- **Category:** **Electronics**
- **Data Security:** Always backup and factory reset devices to erase personal data.
- **If Functional:** List it here on the platform under "Electronics" so a student or community member can reuse it!
- **If Non-Functional / Hazardous:** Never throw electronics or lithium-ion batteries in standard household trash. E-waste contains heavy metals and recyclable rare minerals. Drop them off at an authorized e-waste collection center or manufacturer trade-in program.
- **Recommended 4R Action:** **Reuse** if functional; **Recycle** via certified e-waste facilities if dead.`;
  }

  if (query.includes('4r') || query.includes('principle') || (query.includes('reduce') && query.includes('reuse'))) {
    return `### 🌱 The 4R Principles Explained
1. **Reduce:** The most effective step—minimize consumption, choose durable goods, and avoid single-use packaging.
2. **Reuse:** Extend item lifespans by sharing, repairing, upcycling, or listing items on our platform for someone else to use.
3. **Recycle:** Convert processed waste materials into new products through official recycling streams (paper, clean plastics, metals, glass).
4. **Recover:** Extract valuable energy, nutrients, or material from remaining waste, such as organic composting or waste-to-energy recovery.`;
  }

  if (query.includes('how to add') || query.includes('add item') || query.includes('list item')) {
    return `### 📦 How to Add an Item to the Platform
1. Click **"Add Item"** in the top navigation bar.
2. Enter the item's name, description, condition, quantity, and location.
3. Click the **"✨ Ask Eco AI"** button in the form for automatic category and 4R pathway recommendations!
4. Upload or select an image and click **Submit Item**.
Your listing will immediately appear in **Browse Items** for other users to request!`;
  }

  if (query.includes('request') || query.includes('how does request work')) {
    return `### 🤝 How to Request an Item
1. Go to **"Browse Items"** in the navigation.
2. Search or filter by Category (Electronics, Furniture, etc.) and Condition.
3. Click on any item card to see full specifications and location.
4. Click **"Request Item"** to express interest. The item owner will receive an instant notification in their dashboard to approve!`;
  }

  if (query.includes('category') || query.includes('which category')) {
    return `### 🏷️ Supported Categories
Our platform supports 11 standardized categories:
- **Electronics** (phones, cables, monitors, gadgets)
- **Books** (textbooks, novels, manuals)
- **Clothes** (apparel, footwear, textiles)
- **Furniture** (chairs, tables, shelving)
- **Plastic** (containers, durable goods)
- **Glass** (jars, decor, cookware)
- **Metal** (cookware, scrap, tools)
- **Paper** (notebooks, packaging, cartons)
- **Household Items** (appliances, decor, tools)
- **Toys** (games, puzzles, figures)
- **Others** (miscellaneous reusable materials)`;
  }

  if (query.includes('chair') || query.includes('table') || query.includes('desk') || query.includes('furniture')) {
    return `### 🪑 Item Recommendation: Furniture
- **Category:** **Furniture**
- **Suggested Action:** **Reuse**. Wooden, metal, or upholstered furniture can often serve a new home with minor cleaning or tightening.
- **Tip:** If broken, assess if it can be upcycled or repaired. If discarded, look for bulk municipal collection or timber material recovery.`;
  }

  return `### 🌿 Eco AI Assistant Guidance
Thank you for your question about sustainable waste management!

- **4R Pathway:** Whenever evaluating unwanted goods, always consider **Reduce** > **Reuse** > **Recycle** > **Recover**.
- **Community Reuse:** Usable items can be listed on this platform so neighbors can claim them rather than sending them to landfills.
- **Safety Note:** For hazardous chemicals, motor oil, medical waste, or lithium batteries, please take them directly to municipal hazardous waste drop-off locations.

*Tip: Feel free to ask about specific items (e.g. "What do I do with old books?"), categories, or how to use this platform!*`;
}

// Health check endpoint
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    aiEnabled: !!aiClient,
    timestamp: new Date().toISOString(),
  });
});

function withTimeout<T>(promise: Promise<T>, ms: number = 6000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation timed out after ${ms}ms`));
    }, ms);
    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

// Chat endpoint
app.post('/api/eco-ai/chat', async (req: Request, res: Response) => {
  const { message, history } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: 'Message cannot be empty.' });
    return;
  }

  const sanitizedMessage = message.trim();

  // If Gemini client is active, use it
  if (aiClient) {
    try {
      const systemInstruction = `You are "Eco AI Assistant", a friendly, knowledgeable sustainability expert embedded within the "Smart Sustainability Waste Management System".
Your mission is to guide users on the 4R principles: Reduce, Reuse, Recycle, and Recover.

Guidelines:
1. Provide concise, well-structured answers using clean Markdown and bullet points.
2. For any item mentioned, identify its category from these exact 11 categories:
   - Electronics, Books, Clothes, Furniture, Plastic, Glass, Metal, Paper, Household Items, Toys, Others.
3. Recommend an appropriate 4R pathway (Reduce, Reuse, Recycle, or Recover) and briefly explain why.
4. If asked about platform features (Add Item, Browse Items, Requests, Dashboard, Notifications), explain clearly how to use them.
5. Safety Rule: For hazardous waste, chemicals, batteries, medical supplies, or toxic electronic waste, clearly provide safety precautions and recommend certified municipal/authorized recycling drop-off facilities.
6. Never claim that you or the platform physically collects or transports waste.
7. If you do not know a specific detail, state so clearly and provide general sustainability best practices.`;

      const response = await withTimeout(
        aiClient.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: sanitizedMessage,
          config: {
            systemInstruction,
            temperature: 0.7,
          },
        }),
        6000
      );

      const replyText = response.text || generateFallbackResponse(sanitizedMessage);
      res.json({ reply: replyText });
      return;
    } catch (error: any) {
      console.warn('Gemini API call failed or timed out, falling back to expert knowledge base:', error?.message);
      // Graceful fallback to rule engine
      const reply = generateFallbackResponse(sanitizedMessage);
      res.json({ reply });
      return;
    }
  }

  // Fallback engine if no API key configured
  const reply = generateFallbackResponse(sanitizedMessage);
  res.json({ reply });
});

// Item Suggestion endpoint for Add Item form
app.post('/api/eco-ai/suggest-item', async (req: Request, res: Response) => {
  const { name, description } = req.body;

  if (!name || typeof name !== 'string') {
    res.status(400).json({ error: 'Item name is required.' });
    return;
  }

  const combinedText = `${name}. ${description || ''}`.trim();

  if (aiClient) {
    try {
      const prompt = `Analyze this unwanted item for the "Smart Sustainability Waste Management System":
Item Name: "${name}"
Description: "${description || 'None provided'}"

Classify into one of these exact categories:
Electronics, Books, Clothes, Furniture, Plastic, Glass, Metal, Paper, Household Items, Toys, Others.

Select one recommended 4R action from: Reduce, Reuse, Recycle, Recover.
Provide realistic possibilities for reuse and recycling, along with a concise sustainability tip.

Return strictly valid JSON with the following schema:
{
  "category": "One of the 11 categories listed above",
  "reusePossibility": "Short explanation of reuse or donation viability",
  "recyclingPossibility": "Short explanation of recycling or material reclamation",
  "recommended4RAction": "Reduce" | "Reuse" | "Recycle" | "Recover",
  "sustainabilityTip": "A 1-2 sentence actionable eco tip for this item"
}`;

      const response = await withTimeout(
        aiClient.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        }),
        6000
      );

      if (response.text) {
        try {
          const parsed = JSON.parse(response.text.trim());
          res.json(parsed);
          return;
        } catch (e) {
          console.warn('Failed to parse Gemini JSON response:', e);
        }
      }
    } catch (err: any) {
      console.warn('Gemini suggest-item failed, using heuristic fallback:', err?.message);
    }
  }

  // Fallback heuristic classification
  const lower = combinedText.toLowerCase();
  let category: any = 'Others';
  let recommended4RAction: any = 'Reuse';
  let reusePossibility = 'Great candidate for community sharing, donation, or listing on this platform.';
  let recyclingPossibility = 'Check your municipal guidelines or local collection centers for material separation.';
  let sustainabilityTip = 'Listing this item keeps it in active circulation and reduces landfill accumulation!';

  if (lower.includes('phone') || lower.includes('laptop') || lower.includes('cable') || lower.includes('charger') || lower.includes('tv') || lower.includes('monitor') || lower.includes('computer')) {
    category = 'Electronics';
    recommended4RAction = 'Reuse';
    reusePossibility = 'If working, donate or share with students/schools. Wipe personal data first.';
    recyclingPossibility = 'Deliver to authorized e-waste depots for rare mineral recovery.';
    sustainabilityTip = 'E-waste recycling prevents toxic heavy metals from contaminating groundwater.';
  } else if (lower.includes('book') || lower.includes('novel') || lower.includes('textbook') || lower.includes('comic')) {
    category = 'Books';
    recommended4RAction = 'Reuse';
    reusePossibility = 'Donate to public libraries, little free libraries, or local students.';
    recyclingPossibility = 'Paper pages are recyclable, but hardcovers should be separated.';
    sustainabilityTip = 'A single book can be read and enjoyed by dozens of readers over its lifetime!';
  } else if (lower.includes('shirt') || lower.includes('pant') || lower.includes('jean') || lower.includes('jacket') || lower.includes('dress') || lower.includes('coat') || lower.includes('cloth')) {
    category = 'Clothes';
    recommended4RAction = 'Reuse';
    reusePossibility = 'Donate, swap with friends, or list for community adoption.';
    recyclingPossibility = 'Shred into textile fibers, insulation, or acoustic dampening material.';
    sustainabilityTip = 'Extending the life of a garment by just 9 months reduces its carbon footprint by 20-30%.';
  } else if (lower.includes('chair') || lower.includes('table') || lower.includes('desk') || lower.includes('sofa') || lower.includes('shelf') || lower.includes('bed')) {
    category = 'Furniture';
    recommended4RAction = 'Reuse';
    reusePossibility = 'Perfect for college dorms, community centers, or upcycling with fresh paint.';
    recyclingPossibility = 'Wood can be chipped for mulch, metal hardware can be scrapped.';
    sustainabilityTip = 'Solid furniture often outlasts fast-fashion furnishings when cared for properly.';
  } else if (lower.includes('bottle') || lower.includes('container') || lower.includes('tub') || lower.includes('plastic')) {
    category = 'Plastic';
    recommended4RAction = 'Recycle';
    reusePossibility = 'Can be repurposed for workshop organization, seed starters, or storage.';
    recyclingPossibility = 'Clean thoroughly and sort into curbside bins (#1 PET, #2 HDPE).';
    sustainabilityTip = 'Always rinse food residue so the entire recycling batch is not contaminated.';
  } else if (lower.includes('jar') || lower.includes('glass') || lower.includes('vase')) {
    category = 'Glass';
    recommended4RAction = 'Reuse';
    reusePossibility = 'Wash thoroughly to store bulk spices, pantry grains, or small planters.';
    recyclingPossibility = '100% infinitely recyclable without quality degradation in dedicated glass bins.';
    sustainabilityTip = 'Recycling 1 glass bottle saves enough energy to power a 100W light bulb for 4 hours!';
  } else if (lower.includes('can') || lower.includes('pan') || lower.includes('pot') || lower.includes('metal') || lower.includes('aluminum')) {
    category = 'Metal';
    recommended4RAction = 'Recycle';
    reusePossibility = 'Metal cookware can often be re-seasoned or cleaned with vinegar and soda.';
    recyclingPossibility = 'Aluminum and steel are highly valuable scrap materials with infinite recyclability.';
    sustainabilityTip = 'Recycling aluminum uses 95% less energy than refining new bauxite ore.';
  } else if (lower.includes('paper') || lower.includes('cardboard') || lower.includes('box')) {
    category = 'Paper';
    recommended4RAction = 'Recycle';
    reusePossibility = 'Use boxes for shipping, moving, or storage organizers.';
    recyclingPossibility = 'Flatten boxes and recycle in dry paper stream or shred for brown compost.';
    sustainabilityTip = 'Flattening cardboard boxes saves valuable space in recycling transport trucks!';
  } else if (lower.includes('toy') || lower.includes('puzzle') || lower.includes('lego') || lower.includes('doll')) {
    category = 'Toys';
    recommended4RAction = 'Reuse';
    reusePossibility = 'Pass on to daycares, younger siblings, pediatric clinics, or community drives.';
    recyclingPossibility = 'Check for battery removal before exploring mixed-plastic recycling.';
    sustainabilityTip = 'Passing along durable toys teaches children the value of sharing and sustainability.';
  }

  res.json({
    category,
    reusePossibility,
    recyclingPossibility,
    recommended4RAction,
    sustainabilityTip,
  });
});

// Vite & Static file serving
async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
});
