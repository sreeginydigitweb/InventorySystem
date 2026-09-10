# capability/

Stores what this system is able to do, and where its limits are.

## What belongs here

- Capability definitions
- Capability descriptions explaining what each one covers
- Supported functions
- Boundaries — what is explicitly out of scope for a capability
- Related capability specifications

Recording boundaries matters as much as recording what is supported; it prevents
work being built on an assumed capability that does not exist.

## What does not belong here

- Implementation code
- Reusable prompts — those belong in `prompts/`
- General project documentation — that belongs in `documentation/`
