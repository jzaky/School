# AEGIS Python SDK

Standard library only (Python 3.9 or later). Routes tool calls from Python agent frameworks
through the AEGIS Action Gateway and fails closed when the gateway cannot be reached.

- `guard(client, tool)`: decorator for any function an agent runtime calls.
- `crewai_tool(client, tool)`: wraps a CrewAI `BaseTool` instance.
- `autogen_function(client, fn)`: wraps a function before registering it with AutoGen.
- `semantic_kernel_function(client, fn)`: the same wrapper for Microsoft Semantic Kernel functions.

Tests: `python3 -m unittest discover -s tests -t .` from this directory. They run against a local
stand-in for the gateway API; they do not install or exercise CrewAI, AutoGen or Semantic Kernel.
