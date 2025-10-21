# vitest-environment-vscode Roadmap

This roadmap complements the architectural details in `docs/design.md`. It tracks the phased delivery plan, success metrics, and longer-term enhancements for the custom Vitest VS Code pool.

## Implementation Phases

### Phase 1: Proof of Concept (MVP)

- [ ] Basic pool structure implementing `ProcessPool`
- [ ] VS Code instance launching with `@vscode/test-electron`
- [ ] Worker script that runs inside the Extension Host
- [ ] Socket-backed RPC communication using `birpc`
- [ ] Single test file execution

**Deliverables**

- Pool launches VS Code and runs one simple test
- Test reaches `vscode.window.showInformationMessage`
- Results surface back to the Vitest main process

### Phase 2: Core Functionality

- [ ] Full `createMethodsRPC` integration
- [ ] Multiple test file support
- [ ] Workspace management
- [ ] Test isolation and cleanup
- [ ] Error handling and stack traces
- [ ] Configuration options

**Deliverables**

- Support for common test patterns across multiple files
- Accurate error reporting
- Configurable pool behavior

### Phase 3: Advanced Features

- [ ] Instance pooling for parallel execution
- [ ] Watch mode support
- [ ] Coverage reporting integration
- [ ] Snapshot testing
- [ ] Custom runner for VS Code-specific features

**Deliverables**

- Production-ready pool
- Comprehensive documentation
- Reference example projects

### Phase 4: Ecosystem Integration

- [ ] Migration guide from `@vscode/test-electron`
- [ ] CI/CD integration examples
- [ ] Performance benchmarks vs traditional approach
- [ ] Community feedback integration

## Success Metrics

1. **Developer Adoption**
    - GitHub stars, npm downloads
    - VS Code marketplace extensions using the pool

2. **Performance**
    - Test execution speed vs `@vscode/test-electron`
    - Startup time < 5 seconds
    - API call overhead < 10ms average

3. **Reliability**
    - CI/CD success rates
    - Issue reports and bug frequency

4. **DX Quality**
    - Documentation completeness
    - Example coverage
    - Community feedback sentiment

## Future Enhancements

1. **Browser Mode Support**: Extend to support VS Code for Web testing
2. **Multi-Extension Testing**: Validate interactions across multiple extensions
3. **UI Testing Helpers**: Utilities for testing webviews, tree views, and other UI surfaces
4. **Performance Profiling**: Built-in profiling hooks for extension performance
5. **Visual Regression Testing**: Screenshot comparison tooling for UI elements
