import { Home, ChevronRight } from 'lucide-react';

import { Link } from '@@/Link';

export interface Crumb {
  label: string;
  link?: string;
  linkParams?: Record<string, unknown>;
}
interface Props {
  breadcrumbs: (Crumb | string)[] | string;
}

export function Breadcrumbs({ breadcrumbs }: Props) {
  const breadcrumbsArray =
    Array.isArray(breadcrumbs) && breadcrumbs.length > 0
      ? breadcrumbs
      : [Array.isArray(breadcrumbs) ? '' : breadcrumbs];

  const homeLink = (
    <Link
      to="portainer.home"
      className="p-1.5 text-gray-8 hover:text-blue-11 th-highcontrast:text-white th-dark:text-gray-5 th-dark:hover:text-blue-9 max-[991px]:-m-[8px] max-[991px]:flex max-[991px]:min-h-[44px] max-[991px]:min-w-[44px] max-[991px]:items-center max-[991px]:justify-center max-[991px]:p-0"
      data-cy="breadcrumb-home"
      aria-label="Home"
    >
      <Home className="h-4 w-4" />
    </Link>
  );

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex items-center gap-2 text-sm font-medium text-gray-8 th-highcontrast:text-white th-dark:text-gray-5 max-[991px]:flex-wrap max-[991px]:gap-x-1 max-[991px]:[overflow-wrap:anywhere]"
    >
      {breadcrumbsArray.map((crumb, index) => (
        <span
          key={index}
          className="flex items-center gap-2 max-[991px]:min-w-0"
        >
          {index === 0 && homeLink}
          <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="max-[991px]:min-w-0">
            {renderCrumb(crumb, index === breadcrumbsArray.length - 1)}
          </span>
        </span>
      ))}
    </nav>
  );
}

// the last crumb is the page you are on
function renderCrumb(crumb: Crumb | string, isCurrent: boolean) {
  if (!crumb) {
    return '';
  }

  const current = isCurrent ? 'page' : undefined;

  if (typeof crumb === 'string') {
    return <span aria-current={current}>{crumb}</span>;
  }

  if (crumb.link) {
    return (
      <Link
        to={crumb.link}
        params={crumb.linkParams}
        className="text-blue-9 hover:text-blue-11 hover:underline th-highcontrast:text-blue-5 th-dark:text-blue-7 th-dark:hover:text-blue-9"
        data-cy={`breadcrumb-${crumb.label}`}
        aria-current={current}
      >
        {crumb.label}
      </Link>
    );
  }

  return <span aria-current={current}>{crumb.label}</span>;
}
