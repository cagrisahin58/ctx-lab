## Data Pipeline
- [x] Set up data loaders {id: data}
- [x] Implement preprocessing {id: preprocess, depends: data}
- [>] Train baseline model {id: train, depends: preprocess}
- [ ] Evaluate baseline {id: eval, depends: train}

## Optimization Branch
- [ ] Hyperparameter search {id: hpsearch, depends: train}
- [ ] Knowledge distillation {id: distill, depends: train}
- [ ] Compare optimized models {id: compare, depends: hpsearch, distill}

## Deployment
- [ ] Export to ONNX {id: export, depends: eval, compare}
