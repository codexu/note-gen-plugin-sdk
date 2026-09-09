#!/usr/bin/env node
import { runCreateCli } from '@notegen/plugin-cli'

process.exitCode = await runCreateCli()
