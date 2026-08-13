# Charlie

## Product Vision

Charlie is an Alexa-first AI family assistant designed to help older adults live more independently, stay connected to their families, and interact with a technology-heavy world through ordinary conversation.

The fundamental UX principle is:

> **The family uses technology normally. Grandma just talks.**

Charlie is not primarily a monitoring product, medical device, or generic Alexa replacement. Charlie is the intelligent relationship layer connecting an older adult, their trusted family, Alexa, and eventually useful real-world services.

Alexa is Charlie's primary senior-facing interface. Voice interaction is essential. Echo Show screens and cameras should enhance the experience, but core functionality should remain useful on screenless Echo devices.

## Product Principles

### 1. Voice First

The senior should accomplish core tasks by speaking naturally.

Avoid requiring menus, apps, touch interfaces, memorized commands, or technical concepts.

A request such as:

> "Wasn't somebody coming over tomorrow?"

should be interpreted based on family context rather than requiring a rigid command.

### 2. Progressive Enhancement

Core functionality must work on screenless Echo devices.

When a display is available, Charlie should enhance the interaction with:

- Family photos
- Large readable text
- Daily schedules
- Touch controls
- Visual confirmations
- Media
- Contextual information

Never make a screen necessary for a core voice workflow unless the feature is inherently visual.

### 3. Humans Communicate Normally

Charlie should adapt to humans rather than requiring humans to perform data entry.

Family members should be able to:

- Send normal text messages
- Send normal photos
- Send audio/video recordings
- Speak naturally
- Correct Charlie conversationally

Charlie converts these interactions into structured knowledge.

### 4. Family Thread as Control Plane

The family messaging thread is Charlie's primary caregiver/family interface.

The long-term goal is that family members should rarely need a dedicated Charlie application.

Examples:

> "Remind Grandma about her appointment tomorrow."

> "I'm coming over around three."

> "Tell her I'll bring groceries."

> [family photo]

> "That's Natalie at her birthday party."

Charlie should interpret these naturally.

### 5. Charlie Is for the Senior, Not About the Senior

Caregiving features may motivate the purchase, but Charlie must provide direct value to the older adult.

Examples include:

- Family communication
- Family photos
- Music and podcasts
- Stories
- Family memories
- Daily agenda
- Reminders
- Transportation
- Food and shopping assistance
- Everyday questions
- Assistance interacting with technology and services

Charlie should feel like an assistant the senior owns, not surveillance installed by their children.

### 6. Dignity and Privacy

Charlie should provide reassurance without unnecessary surveillance.

Never silently record conversations.

Any future recording/listening functionality must require obvious affirmative activation and clear indication that recording is occurring.

Family-visible activity should default to useful high-level information rather than detailed surveillance.

### 7. Humans Authorize Consequential Actions

Charlie may eventually interact with services such as food delivery, transportation, shopping, and home services.

Charlie can research, prepare, compare, and propose actions.

Consequential real-world actions should support explicit authorization policies.

Example:

Senior requests dinner.

Charlie prepares:

- Restaurant
- Order
- Price
- Delivery estimate

Family receives an approval request.

Only after authorization may Charlie execute the purchase.

Authorization must be enforced architecturally, not merely by an LLM prompt.

### 8. Alexa Is the Interface, Charlie Is the Intelligence

Charlie should not depend on Alexa being the reasoning engine.

The architecture is:

Senior speech  
→ Alexa speech recognition  
→ Charlie backend  
→ Charlie reasoning/context  
→ Alexa response  
→ Alexa text-to-speech

Our backend should be capable of authoring dynamic speech responses that Alexa speaks.

Charlie should work on Alexa devices that do not support Alexa+ whenever the Alexa Custom Skills platform permits it.

### 9. Model Independence

Application code should not assume Charlie always uses one AI vendor or model.

Prefer capability-oriented abstractions such as:

- `extractFamilyKnowledge()`
- `answerFamilyQuestion()`
- `describePhoto()`
- `summarizeStory()`
- `classifyMessage()`

Different operations may eventually use different models.

Simple extraction/classification should eventually be candidates for inexpensive small/open models.

Complex reasoning and senior-facing conversation may use stronger models.

Do not prematurely optimize model costs during Weekend Charlie.

### 10. Provenance Is Fundamental

Charlie must distinguish facts from AI inference.

Never allow an LLM to silently turn an inference into family truth.

Important knowledge should retain its source.

Conceptually:

```text
Fact
  subject
  predicate
  value

  source
    type
    id
    author

  confidence
  created_at
```

Useful confidence/provenance concepts include:

- Explicitly stated
- Family confirmed
- AI inferred
- Uncertain
- Disputed

The original source artifact should be preserved whenever practical.

For example, an audio story should eventually retain:

1. Original recording
2. Transcript
3. Charlie's structured interpretation

The interpretation is not a replacement for the source.

## Family Canon

Charlie will eventually maintain a private, provenance-aware family knowledge system called **Family Canon**.

It may contain:

- People
- Relationships
- Aliases and nicknames
- Photos
- Videos
- Audio recordings
- Messages
- Events
- Places
- Stories
- Family history
- Preferences
- Memories

Example:

```text
Jenna
└── younger sister → Hannah
    ├── daughter → Natalie Rose
    └── son → James Thomas
        └── preferred name → JT
```

Charlie should understand relationships relative to the person asking.

For example, the same person may be:

- Jenna's niece
- Hannah's daughter
- Grandma's granddaughter

Charlie should progressively learn the family rather than requiring a complete family tree during onboarding.

## Conversational Onboarding

Long term, Charlie should learn about the family conversationally.

Example:

> "I'm Jenna. I don't have any kids, but this is my niece Natalie Rose and my nephew James Thomas. We call him JT. Their mother Hannah is my younger sister."

Charlie should extract the relationships and aliases rather than requiring a family-tree form.

Missing information does not need to be collected immediately.

Charlie may ask clarifying questions when useful, but onboarding should not become an interrogation.

## Family Photos

Family members should eventually be able to send photos through the family messaging channel.

Charlie should retain:

- Original image
- Sender
- Caption/message
- Timestamp
- Related people
- Related event
- AI description
- Provenance

On an Echo Show:

> "Show me the latest family pictures."

should display them.

Natural queries should eventually include:

> "Show me pictures of Natalie."

> "Show me Natalie's last birthday party."

> "What was that picture Jenna sent yesterday?"

> "Who is that?"

On screenless Echo devices, Charlie may describe photos conversationally.

## Family Stories

Family members may eventually send recordings or videos of family conversations and stories.

Charlie should be able to:

- Preserve the original recording
- Transcribe it
- Identify or infer speakers with appropriate confidence
- Extract people/events/places/relationships
- Ask family members about unresolved identities
- Connect stories to existing photos/events
- Preserve disagreements rather than fabricate certainty

Example:

If one person says a vacation occurred in 1978 and another says 1979, Family Canon may retain that disagreement.

## Reminders

Charlie should eventually support routines such as:

- Medication reminders
- Appointments
- Hydration
- Exercise/PT
- Meals
- Household tasks

Charlie is initially a reminder/coordination service, not a medical device.

Never claim medication adherence has been medically verified.

A senior saying:

> "I took my pills."

is a **self-reported confirmation**.

Alexa Reminders should be investigated and used within Amazon's current permission/consent requirements.

## Daily Log

Charlie should eventually maintain a privacy-conscious daily activity summary.

Example:

```text
8:00 AM  Morning medication reminder delivered
8:12 AM  Medication self-reported as taken
9:03 AM  Asked about today's schedule
11:42 AM Sent a family message
2:14 PM  Listened to a podcast
```

Family-facing summaries should emphasize reassurance and actionable information rather than surveillance.

## Real-World Services — Future

Charlie may eventually provide conversational access to:

- Food delivery
- Transportation
- Groceries
- Shopping
- Home services
- Other consumer services

Preferred integration hierarchy:

```text
Official API
    ↓
Structured integration/deep link
    ↓
Browser agent
    ↓
Human handoff
```

The senior experience should remain consistent regardless of implementation.

Example:

> "I'd like Chinese food."

Charlie handles the technological complexity.

## Weekend Charlie

The immediate objective is **not to build the Charlie platform**.

We are building a feasibility prototype.

### Primary Success Criterion

Send Charlie information via a family text message that Charlie has never seen before.

Then ask an actual Echo device about that information.

Alexa speaks the correct response generated by Charlie.

Example:

Family text:

> "Jenna is coming over tomorrow around three."

Shortly afterward:

> "Alexa, ask Charlie what's happening tomorrow?"

Alexa:

> "Jenna is coming over around three tomorrow."

If this interaction feels natural, Weekend Charlie succeeds.

### Secondary Success Criteria

#### Family knowledge

Charlie can answer:

> "Who is Natalie?"

using seeded family relationships.

#### Echo Show photo

Family sends an MMS photo with context.

Then:

> "Alexa, ask Charlie to show me the latest family picture."

The Echo Show displays it.

## Initial Technical Direction

Keep Weekend Charlie intentionally simple.

Preferred starting stack:

```text
TypeScript
Node.js
Fastify or Express
PostgreSQL / Supabase
Twilio SMS/MMS
AI provider behind an abstraction
Alexa Custom Skill
APL for Echo Show
```

Initial backend:

```text
POST /alexa
POST /twilio/inbound
GET  /health
```

One repository.

One deployable service.

One database.

No microservices.

## Weekend Charlie Build Order

1. Alexa Custom Skill invokes our HTTPS backend.
2. Backend returns server-authored speech.
3. Test on a physical Echo.
4. Add one test household.
5. Add minimal family/person/relationship storage.
6. Connect inbound SMS.
7. Store original incoming messages.
8. Extract structured family knowledge from messages.
9. Ask Alexa about newly received family information.
10. Add outbound family SMS.
11. Add MMS/photo ingestion.
12. Add basic APL photo display on Echo Show.
13. Investigate Alexa Reminders and consent behavior.

Each milestone should work before proceeding to the next.

## Explicitly Out of Scope for Initial Prototype

Do **not** build these unless specifically requested:

- Production-scale architecture
- Microservices
- Kubernetes
- Caregiver mobile app
- Senior mobile app
- Full caregiver web portal
- Billing
- Subscription management
- Production OAuth/account linking
- DoorDash integration
- Uber integration
- Browser agents
- Automated purchases
- Medical monitoring
- Fall detection
- Emergency dispatch
- Continuous Alexa listening
- Full Family Canon ingestion
- Audio-story ingestion
- Automatic facial recognition
- Voice biometrics
- Vector database unless demonstrated necessary
- Complex RAG framework
- Multi-household production authorization
- Premature model-cost optimization

## Engineering Philosophy

Optimize for **learning**, not scalability.

Prefer boring technology.

Prefer explicit code over premature frameworks.

Prefer a working vertical slice over architectural completeness.

Do not build abstractions until they solve an observed problem, with the exception of keeping AI-provider dependencies behind a small capability-oriented interface.

Keep the codebase understandable by one experienced developer.

When choosing between:

> "This will support a million households someday."

and:

> "We can test this on an Echo tonight."

choose the second.

## North Star

Charlie succeeds when technology disappears.

The family communicates normally.

The senior talks normally.

Charlie handles everything in between.