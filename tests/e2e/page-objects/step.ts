import { test } from '@playwright/test';

export function step(title: string) {
  return function reportedMethod<This, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Promise<Result>,
    _context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Promise<Result>>,
  ): (this: This, ...args: Args) => Promise<Result> {
    return async function reportedStep(this: This, ...args: Args): Promise<Result> {
      return test.step(title, () => method.apply(this, args), { box: true });
    };
  };
}
