// tslint:disable no-any
import React from 'react';
import { Container } from 'reakit';

function setState<State>(state: Partial<State>) {
  return (props: any) => {
    props.setState({ state });
  };
}

export function WithState<State>({
  initialState,
  children,
}: {
  readonly initialState: State;
  readonly children?: (
    props: { readonly state: State; readonly setState: (state: Partial<State>) => void },
  ) => React.ReactNode;
}) {
  return <Container effects={{ setState } as any} initialState={{ state: initialState }} children={children as any} />;
}
