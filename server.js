require('dotenv').config();
const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

const app = express();
const PORT = process.env.PORT || 3000;
const EVENTS_FILE = path.join(__dirname, 'events.json');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'change-me';

app.use(express.json());
app.use(express.static(__dirname));

// --- Stripe Checkout Endpoint ---
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { amount, name, email, type } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Donation to Devaloy Mandir (${type})`,
              description: `Generous support from ${name}`,
            },
            unit_amount: Math.round(parseFloat(amount) * 100), // Stripe expects cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      customer_email: email,
      success_url: `${req.headers.origin}/?success=true`,
      cancel_url: `${req.headers.origin}/?canceled=true`,
    });

    res.json({ id: session.id });
  } catch (error) {
    console.error('Stripe Error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function readEventsFile() {
  const raw = await fs.readFile(EVENTS_FILE, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.events)) return { events: [] };
  return parsed;
}

async function writeEventsFile(events) {
  const payload = { events };
  await fs.writeFile(EVENTS_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function validateEventInput(input) {
  const requiredFields = ['title', 'date', 'day', 'time', 'description'];
  for (const field of requiredFields) {
    if (!input[field] || typeof input[field] !== 'string' || !input[field].trim()) {
      return `Invalid or missing field: ${field}`;
    }
  }
  return null;
}

function requireAdmin(req, res, next) {
  const token = req.header('x-admin-token');
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/events', async (req, res) => {
  try {
    const { events } = await readEventsFile();
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load events' });
  }
});

app.post('/api/events', requireAdmin, async (req, res) => {
  try {
    const validationError = validateEventInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const data = await readEventsFile();
    const nextId = data.events.length > 0
      ? Math.max(...data.events.map((event) => Number(event.id) || 0)) + 1
      : 1;

    const event = {
      id: nextId,
      title: req.body.title.trim(),
      date: req.body.date.trim(),
      day: req.body.day.trim(),
      time: req.body.time.trim(),
      description: req.body.description.trim(),
      learnMore: true
    };

    data.events.push(event);
    await writeEventsFile(data.events);
    res.status(201).json({ event });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create event' });
  }
});

app.put('/api/events/:id', requireAdmin, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ error: 'Invalid event id' });
    }

    const validationError = validateEventInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const data = await readEventsFile();
    const index = data.events.findIndex((event) => Number(event.id) === eventId);
    if (index === -1) {
      return res.status(404).json({ error: 'Event not found' });
    }

    data.events[index] = {
      ...data.events[index],
      title: req.body.title.trim(),
      date: req.body.date.trim(),
      day: req.body.day.trim(),
      time: req.body.time.trim(),
      description: req.body.description.trim(),
      learnMore: true
    };

    await writeEventsFile(data.events);
    res.json({ event: data.events[index] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update event' });
  }
});

app.delete('/api/events/:id', requireAdmin, async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    if (!Number.isFinite(eventId)) {
      return res.status(400).json({ error: 'Invalid event id' });
    }

    const data = await readEventsFile();
    const nextEvents = data.events.filter((event) => Number(event.id) !== eventId);
    if (nextEvents.length === data.events.length) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await writeEventsFile(nextEvents);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

app.listen(PORT, () => {
  console.log(`Devaloy server running on http://localhost:${PORT}`);
});
