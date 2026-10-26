// Zod compiles faster validators with new Function() unless told not to. The content security policy forbids eval,
// and even Zod's guarded probe for it is reported as a policy violation, so validation runs without it. Import this
// before defining schemas in any module that also runs in the browser.
import { config } from "zod";

config({ jitless: true });
