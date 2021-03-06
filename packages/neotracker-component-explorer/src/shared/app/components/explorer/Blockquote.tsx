import { as, Base, styled } from 'reakit';

const BlockquoteBase = styled(Base)`
  background-color: rgba(255, 229, 100, 0.3);
  border-left-color: #ffe564;
  border-left-width: 8px;
  border-left-style: solid;
  padding: 20px 16px;
  margin: 20px -24px;

  @media (max-width: 768px) {
    margin-right: 0;
    padding-right: 8px;
  }
`;

export const Blockquote = as('blockquote')(BlockquoteBase);
